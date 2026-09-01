// Runnable check for the HTTP routes: auth, validation, and wiring to D1.
// The drift math itself is covered in drift.test.mjs — these tests just check
// the routes call the database correctly and return the right status codes.
// No Miniflare/wrangler pool needed — Hono's app.fetch(request, env) runs
// standalone against a stubbed D1 binding.
// Usage: node --test test/index.test.mjs

import assert from "node:assert";
import { test } from "node:test";
import worker, { scoreDataQuality } from "../src/index.js";

const SCHEMA = { amount: "float", oldbalanceOrg: "float", type: "string" };

// `models`: { [model_id]: { version, schema_json, baseline_json } }
// `telemetryRows`: rows returned for the drift-check's telemetry SELECT
// `latestDriftReport`: row returned for the GET .../drift SELECT
function fakeDb({ models = {}, telemetryRows = [], latestDriftReport = null, inserts = [] } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          const run = async () => {
            inserts.push({ sql, args });
            return { success: true };
          };
          const first = async () => {
            if (sql.includes("FROM models")) return models[args[0]] ?? null;
            if (sql.includes("FROM drift_reports")) return latestDriftReport;
            return null;
          };
          const all = async () => {
            if (sql.includes("FROM telemetry")) return { results: telemetryRows };
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
  const telemetryRows = [{ features_json: JSON.stringify({ amount: 50 }) }, { features_json: JSON.stringify({ amount: 150 }) }];

  const res = await worker.fetch(request("POST", "/api/v1/models/fraud-detector/drift/run"), {
    ...ENV,
    DB: fakeDb({ models, telemetryRows, inserts }),
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
