// Runnable check for the telemetry route's auth + validation logic.
// No Miniflare/wrangler pool needed — Hono's app.fetch(request, env) runs
// standalone against a stubbed D1 binding.
// Usage: node --test test/index.test.mjs

import assert from "node:assert";
import { test } from "node:test";
import app, { scoreDataQuality } from "../src/index.js";

const SCHEMA = { amount: "float", oldbalanceOrg: "float", type: "string" };

function fakeDb({ model = null, inserts = [] } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => (sql.startsWith("SELECT") ? model : null),
            run: async () => {
              inserts.push({ sql, args });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const ENV = { TELEMETRY_API_KEY: "secret123" };
const REGISTERED_MODEL = { version: "v1", schema_json: JSON.stringify(SCHEMA) };
const VALID_BODY = {
  model_id: "fraud-detector",
  features: { amount: 100, oldbalanceOrg: 100, type: "PAYMENT" },
  prediction: 1,
  probability: 0.9,
  latency_ms: 12.3,
};

function post(body, env) {
  return app.fetch(
    new Request("http://worker/api/v1/telemetry", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret123" },
    }),
    env
  );
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

test("scoreDataQuality: wrong type on a string field counts as invalid", () => {
  assert.strictEqual(scoreDataQuality(SCHEMA, { amount: 5, oldbalanceOrg: 5, type: "" }), 67);
});

test("rejects requests without the telemetry key", async () => {
  const res = await app.fetch(
    new Request("http://worker/api/v1/telemetry", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: { "Content-Type": "application/json" },
    }),
    { ...ENV, DB: fakeDb() }
  );
  assert.strictEqual(res.status, 401);
});

test("rejects a payload missing required fields", async () => {
  const res = await post({ model_id: "fraud-detector" }, { ...ENV, DB: fakeDb() });
  assert.strictEqual(res.status, 422);
});

test("rejects telemetry for an unregistered model_id", async () => {
  const res = await post(VALID_BODY, { ...ENV, DB: fakeDb({ model: null }) });
  assert.strictEqual(res.status, 404);
});

test("inserts telemetry with a computed data_quality_score when authorized and valid", async () => {
  const inserts = [];
  const res = await post(VALID_BODY, { ...ENV, DB: fakeDb({ model: REGISTERED_MODEL, inserts }) });
  assert.strictEqual(res.status, 201);
  const responseBody = await res.json();
  assert.strictEqual(responseBody.data_quality_score, 100);
  assert.strictEqual(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO telemetry/);
  assert.strictEqual(inserts[0].args[0], "fraud-detector");
  assert.strictEqual(inserts[0].args[1], "v1");
  assert.strictEqual(inserts[0].args[7], 100);
});
