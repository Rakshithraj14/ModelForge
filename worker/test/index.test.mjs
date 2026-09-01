// Runnable check for the HTTP routes: auth, validation, and wiring to D1.
// The drift/performance math itself is covered in drift.test.mjs and
// performance.test.mjs — these tests just check the routes call the database
// correctly and return the right status codes.
// No Miniflare/wrangler pool needed — Hono's app.fetch(request, env) runs
// standalone against a stubbed D1 binding.
// Usage: node --test test/index.test.mjs

import assert from "node:assert";
import { test } from "node:test";
import worker, { scoreDataQuality } from "../src/index.js";

const SCHEMA = { amount: "float", oldbalanceOrg: "float", type: "string" };

// `models`: { [model_id]: { version, schema_json, baseline_json } }
// `driftTelemetryRows` / `performanceTelemetryRows`: rows for each check's own SELECT
// `latestDriftReport` / `latestPerformanceReport`: rows for each GET's SELECT
// `labelUpdateChanges`: simulated `changes` count for the labels UPDATE
function fakeDb({
  models = {},
  driftTelemetryRows = [],
  performanceTelemetryRows = [],
  latestDriftReport = null,
  latestPerformanceReport = null,
  labelUpdateChanges = 1,
  inserts = [],
} = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          const run = async () => {
            inserts.push({ sql, args });
            if (sql.startsWith("UPDATE")) return { meta: { changes: labelUpdateChanges } };
            return { success: true, meta: {} };
          };
          const first = async () => {
            if (sql.includes("FROM drift_reports")) return latestDriftReport;
            if (sql.includes("FROM performance_reports")) return latestPerformanceReport;
            if (sql.includes("FROM models")) return models[args[0]] ?? null;
            return null;
          };
          const all = async () => {
            if (sql.startsWith("SELECT features_json")) return { results: driftTelemetryRows };
            if (sql.startsWith("SELECT prediction, actual")) return { results: performanceTelemetryRows };
            return { results: [] };
          };
          return { run, first, all };
        },
      };
    },
  };
}

const ENV = { TELEMETRY_API_KEY: "secret123" };
const AUTH = { Authorization: "Bearer secret123" };
const REGISTERED_MODEL = { version: "v1", schema_json: JSON.stringify(SCHEMA) };
const VALID_BODY = {
  model_id: "fraud-detector",
  features: { amount: 100, oldbalanceOrg: 100, type: "PAYMENT" },
  prediction: 1,
  probability: 0.9,
  latency_ms: 12.3,
};

function request(method, path, { body, headers = AUTH } = {}) {
  return new Request(`http://worker${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("scoreDataQuality: all fields present and valid scores 100", () => {
  assert.strictEqual(scoreDataQuality(SCHEMA, { amount: 5, oldbalanceOrg: 5, type: "PAYMENT" }), 100);
});

test("scoreDataQuality: a missing field lowers the score", () => {
  assert.strictEqual(scoreDataQuality(SCHEMA, { amount: 5, type: "PAYMENT" }), 67);
});

test("scoreDataQuality: a negative numeric field counts as invalid", () => {
  assert.strictEqual(scoreDataQuality(SCHEMA, { amount: -500, oldbalanceOrg: 5, type: "PAYMENT" }), 67);
});

test("POST /api/v1/telemetry: rejects requests without the telemetry key", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/telemetry", { body: VALID_BODY, headers: {} }), {
    ...ENV,
    DB: fakeDb(),
  });
  assert.strictEqual(res.status, 401);
});

test("POST /api/v1/telemetry: rejects a payload missing required fields", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/telemetry", { body: { model_id: "fraud-detector" } }), {
    ...ENV,
    DB: fakeDb(),
  });
  assert.strictEqual(res.status, 422);
});

test("POST /api/v1/telemetry: rejects telemetry for an unregistered model_id", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/telemetry", { body: VALID_BODY }), {
    ...ENV,
    DB: fakeDb({ models: {} }),
  });
  assert.strictEqual(res.status, 404);
});

test("POST /api/v1/telemetry: inserts with a computed data_quality_score when valid", async () => {
  const inserts = [];
  const res = await worker.fetch(request("POST", "/api/v1/telemetry", { body: VALID_BODY }), {
    ...ENV,
    DB: fakeDb({ models: { "fraud-detector": REGISTERED_MODEL }, inserts }),
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(body.data_quality_score, 100);
  assert.strictEqual(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO telemetry/);
  assert.strictEqual(inserts[0].args[1], "v1"); // model_version stamped from the registry
});

test("POST .../drift/run: 404s when the model has no baseline registered", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/models/fraud-detector/drift/run"), {
    ...ENV,
    DB: fakeDb({ models: { "fraud-detector": REGISTERED_MODEL } }), // no baseline_json
  });
  assert.strictEqual(res.status, 404);
});

test("POST .../drift/run: computes and stores a report when telemetry exists", async () => {
  const inserts = [];
  const baseline = { numeric: { amount: { bin_edges: [0, 100, 200], bin_proportions: [0.5, 0.5] } }, categorical: {} };
  const models = { "fraud-detector": { ...REGISTERED_MODEL, baseline_json: JSON.stringify(baseline) } };
  const driftTelemetryRows = [{ features_json: JSON.stringify({ amount: 50 }) }, { features_json: JSON.stringify({ amount: 150 }) }];

  const res = await worker.fetch(request("POST", "/api/v1/models/fraud-detector/drift/run"), {
    ...ENV,
    DB: fakeDb({ models, driftTelemetryRows, inserts }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.sample_size, 2);
  assert.strictEqual(body.max_severity, "LOW"); // matches baseline exactly
  assert.strictEqual(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO drift_reports/);
});

test("GET .../drift: 404s when no report has been computed yet", async () => {
  const res = await worker.fetch(request("GET", "/api/v1/models/fraud-detector/drift"), {
    ...ENV,
    DB: fakeDb({ latestDriftReport: null }),
  });
  assert.strictEqual(res.status, 404);
});

test("GET .../drift: returns the latest stored report", async () => {
  const latestDriftReport = { ts: "2026-01-01T00:00:00.000Z", sample_size: 5, scores_json: JSON.stringify({ amount: 0.02 }), max_severity: "LOW" };
  const res = await worker.fetch(request("GET", "/api/v1/models/fraud-detector/drift"), {
    ...ENV,
    DB: fakeDb({ latestDriftReport }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.scores, { amount: 0.02 });
  assert.strictEqual(body.max_severity, "LOW");
});

test("POST /api/v1/labels: rejects a payload with an invalid actual value", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/labels", { body: { prediction_id: "abc", actual: 2 } }), {
    ...ENV,
    DB: fakeDb(),
  });
  assert.strictEqual(res.status, 422);
});

test("POST /api/v1/labels: 404s when the prediction_id doesn't match any row", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/labels", { body: { prediction_id: "missing", actual: 1 } }), {
    ...ENV,
    DB: fakeDb({ labelUpdateChanges: 0 }),
  });
  assert.strictEqual(res.status, 404);
});

test("POST /api/v1/labels: updates the matching telemetry row", async () => {
  const inserts = [];
  const res = await worker.fetch(request("POST", "/api/v1/labels", { body: { prediction_id: "abc-123", actual: 1 } }), {
    ...ENV,
    DB: fakeDb({ labelUpdateChanges: 1, inserts }),
  });
  assert.strictEqual(res.status, 200);
  assert.match(inserts[0].sql, /UPDATE telemetry SET actual/);
  assert.deepStrictEqual(inserts[0].args, [1, "abc-123"]);
});

test("POST .../performance/run: 404s when there's no labeled telemetry", async () => {
  const res = await worker.fetch(request("POST", "/api/v1/models/fraud-detector/performance/run"), {
    ...ENV,
    DB: fakeDb({ performanceTelemetryRows: [] }),
  });
  assert.strictEqual(res.status, 404);
});

test("POST .../performance/run: computes and stores metrics from labeled telemetry", async () => {
  const inserts = [];
  const performanceTelemetryRows = [
    { prediction: 1, actual: 1 },
    { prediction: 0, actual: 0 },
  ];
  const res = await worker.fetch(request("POST", "/api/v1/models/fraud-detector/performance/run"), {
    ...ENV,
    DB: fakeDb({ performanceTelemetryRows, inserts }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.sample_size, 2);
  assert.strictEqual(body.accuracy, 1);
  assert.match(inserts[0].sql, /INSERT INTO performance_reports/);
});

test("GET .../performance: returns the latest stored report", async () => {
  const latestPerformanceReport = { ts: "2026-01-01T00:00:00.000Z", sample_size: 10, accuracy: 0.9, precision: 0.8, recall: 0.7, f1: 0.75 };
  const res = await worker.fetch(request("GET", "/api/v1/models/fraud-detector/performance"), {
    ...ENV,
    DB: fakeDb({ latestPerformanceReport }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.accuracy, 0.9);
});
